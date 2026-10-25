// Hosting provider referral links are centralized here.
export const HOSTING_PROVIDERS = [
  { name: "VDSina", url: "https://www.vdsina.com/?partner=62n73usqa1jp", domain: "www.vdsina.com" },
  {
    name: "HIP Hosting",
    url: "https://hip.hosting/?code=9f78107d10447a5f9b47",
    domain: "hip.hosting",
  },
] as const;

export const AUTHOR_URL = "https://t.me/buldozercode";

export const RECOMMENDED_VPS = [
  { label: "Operating system", value: "Ubuntu 24.04 LTS" },
  { label: "Architecture", value: "x86_64 (AMD / Intel)" },
  { label: "Processor", value: "At least 2 vCPU" },
  { label: "Memory", value: "At least 4 GB RAM" },
  { label: "Disk", value: "At least 25 GB SSD / NVMe" },
  { label: "Access", value: "SSH, root or sudo" },
] as const;
