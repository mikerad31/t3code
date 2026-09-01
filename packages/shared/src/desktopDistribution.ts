export const DESKTOP_DISTRIBUTION = {
  appId: "com.mikerad31.t3code.hardened",
  packageName: "t3code-hardened",
  productName: "T3 Code Hardened",
  userDataDirName: "t3code-hardened",
  updateRepository: {
    owner: "mikerad31",
    repo: "t3code",
  },
} as const;

export const OFFICIAL_DESKTOP_USER_DATA_DIRS = {
  legacy: "T3 Code (Alpha)",
  modern: "t3code",
} as const;
