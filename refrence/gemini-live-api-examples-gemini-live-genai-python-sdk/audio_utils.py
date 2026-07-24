"""
Pure Python replacements for the standard library `audioop` module,
which was removed in Python 3.13+.

Provides:
  - lin2ulaw(bytes_in, width)  -> bytes: 16-bit linear PCM to μ-law
  - ulaw2lin(bytes_in, width)  -> bytes: μ-law to 16-bit linear PCM
  - ratecv(bytes_in, width, nchannels, inrate, outrate, state) -> (bytes, state)
"""

import struct
from typing import Optional


# ---------------------------------------------------------------------------
# μ-law → 16-bit linear PCM (256-entry table)
# ---------------------------------------------------------------------------

_ulaw2lin_table: list[int] = []

for i in range(256):
    ulaw = i ^ 0xFF  # μ-law is stored with inverted bits
    sign = ulaw & 0x80
    exponent = (ulaw >> 4) & 0x07
    mantissa = ulaw & 0x0F
    if exponent == 0:
        sample = (mantissa << 3) + 0x84
    else:
        sample = ((mantissa | 0x10) << (exponent + 3)) + 0x84
    if sign:
        sample = -sample
    _ulaw2lin_table.append(sample)


# ---------------------------------------------------------------------------
# 16-bit linear PCM → μ-law (computed on-the-fly using G.711 formula)
# ---------------------------------------------------------------------------

def _encode_ulaw(sample: int) -> int:
    """
    Encode a single 16-bit PCM sample to μ-law byte (0-255).
    Implements ITU-T G.711 μ-law encoding.
    """
    BIAS = 0x84

    if sample < 0:
        sign = 0x80
        sample = -sample
    else:
        sign = 0

    if sample > 32767:
        sample = 32767

    sample += BIAS

    if sample >= 0x4000:
        exponent = 7
        mantissa = (sample >> 8) & 0x0F
    elif sample >= 0x2000:
        exponent = 6
        mantissa = (sample >> 7) & 0x0F
    elif sample >= 0x1000:
        exponent = 5
        mantissa = (sample >> 6) & 0x0F
    elif sample >= 0x0800:
        exponent = 4
        mantissa = (sample >> 5) & 0x0F
    elif sample >= 0x0400:
        exponent = 3
        mantissa = (sample >> 4) & 0x0F
    elif sample >= 0x0200:
        exponent = 2
        mantissa = (sample >> 3) & 0x0F
    elif sample >= 0x0100:
        exponent = 1
        mantissa = (sample >> 2) & 0x0F
    else:
        exponent = 0
        mantissa = (sample >> 2) & 0x0F

    return (~(sign | (exponent << 4) | mantissa)) & 0xFF


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def lin2ulaw(bytes_in: bytes, width: int) -> bytes:
    """
    Convert 16-bit linear PCM samples to μ-law encoding.

    Args:
        bytes_in: Input bytes of 16-bit linear PCM (little-endian).
        width: Sample width in bytes (must be 2).

    Returns:
        μ-law encoded bytes (1 byte per sample).
    """
    if width != 2:
        raise ValueError(f"lin2ulaw: only width=2 is supported, got width={width}")

    count = len(bytes_in) // 2
    out = bytearray(count)
    for i in range(count):
        sample = struct.unpack_from("<h", bytes_in, i * 2)[0]
        out[i] = _encode_ulaw(sample)
    return bytes(out)


def ulaw2lin(bytes_in: bytes, width: int) -> bytes:
    """
    Convert μ-law encoded samples to 16-bit linear PCM.

    Args:
        bytes_in: μ-law encoded bytes (1 byte per sample).
        width: Sample width in bytes for output (must be 2).

    Returns:
        16-bit linear PCM bytes (little-endian).
    """
    if width != 2:
        raise ValueError(f"ulaw2lin: only width=2 is supported, got width={width}")

    out = bytearray(len(bytes_in) * 2)
    for i, b in enumerate(bytes_in):
        sample = _ulaw2lin_table[b]
        struct.pack_into("<h", out, i * 2, sample)
    return bytes(out)


def ratecv(
    bytes_in: bytes,
    width: int,
    nchannels: int,
    inrate: int,
    outrate: int,
    state: Optional[bytes],
) -> tuple[bytes, Optional[bytes]]:
    """
    Convert the sample rate of PCM audio using linear interpolation.

    Args:
        bytes_in: Input PCM data.
        width: Sample width in bytes (must be 2 for 16-bit).
        nchannels: Number of channels (must be 1 for mono).
        inrate: Input sample rate (Hz).
        outrate: Output sample rate (Hz).
        state: Optional previous unconsumed bytes (for streaming).

    Returns:
        Tuple of (converted_bytes, new_state).
    """
    if width != 2:
        raise ValueError(f"ratecv: only width=2 is supported, got width={width}")
    if nchannels != 1:
        raise ValueError(f"ratecv: only nchannels=1 is supported, got nchannels={nchannels}")

    # Combine leftover state with new data
    combined = (state or b"") + bytes_in
    in_count = len(combined) // width  # number of input samples

    # Output length: ratio-based, floor to integer
    out_count = (in_count * outrate) // inrate

    out = bytearray(out_count * width)
    for i in range(out_count):
        # Compute the source position in the input stream (rational index)
        src_index = (i * inrate) / outrate
        src_floor = int(src_index)
        src_frac = src_index - src_floor

        if src_floor + 1 < in_count:
            # Linear interpolation between two samples
            s0 = struct.unpack_from("<h", combined, src_floor * width)[0]
            s1 = struct.unpack_from("<h", combined, (src_floor + 1) * width)[0]
            sample = int(s0 + (s1 - s0) * src_frac)
        else:
            # Last sample – just copy
            sample = struct.unpack_from("<h", combined, src_floor * width)[0]

        # Clamp to 16-bit range
        sample = max(-32768, min(32767, sample))
        struct.pack_into("<h", out, i * width, sample)

    # Compute unconsumed bytes for next call
    consumed_samples = (out_count * inrate + outrate - 1) // outrate  # ceiling
    consumed_bytes = consumed_samples * width
    new_state = combined[consumed_bytes:] if consumed_bytes < len(combined) else b""

    return bytes(out), new_state if new_state else None