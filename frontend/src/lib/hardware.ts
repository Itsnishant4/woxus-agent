const HWID_KEY = "woxus_hardware_id";

function generate(): string {
  const chars = "ABCDEF0123456789";
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
    if (i % 4 === 3 && i < 15) id += "-";
  }
  return id;
}

export function getHardwareId(): string {
  let hwid = localStorage.getItem(HWID_KEY);
  if (!hwid) {
    hwid = generate();
    localStorage.setItem(HWID_KEY, hwid);
  }
  return hwid;
}
