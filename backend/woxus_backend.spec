# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — Woxus backend (one-folder bundle).

Build:  python -m PyInstaller woxus_backend.spec
Output: dist/woxus-backend/ (binary + _internal/)
"""

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, collect_submodules

hidden_imports = collect_submodules("faster_whisper") + [
    "llama_cpp",
    "ctranslate2",
    "tokenizers",
    "pymongo",
    "huggingface_hub",
    "dotenv",
]

datas = (
    collect_data_files("tokenizers")
    + collect_data_files("faster_whisper", include_py_files=False)
)

binaries = (
    collect_dynamic_libs("llama_cpp")
    + collect_dynamic_libs("ctranslate2")
    + collect_dynamic_libs("tokenizers")
)

a = Analysis(
    ["packaged_entry.py"],
    pathex=[".."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest", "setuptools"],
    noarchive=False,
    optimize=1,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="woxus-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="woxus-backend",
)
