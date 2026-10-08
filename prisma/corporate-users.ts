/**
 * Corporate management team for X-Group Hospitality.
 *
 * All are GLOBAL users (`branchId = null`) â€” they belong to head office, not to
 * a branch outlet.
 *
 * `email` is left empty where the source sheet had none; the import generates
 * `first.last@x-grouprestaurant.com` and prints the result so it can be
 * corrected. Set an explicit `email` to override.
 *
* `signatureImageUrl` maps to the EXISTING `users.signature_url` column. There is
 * deliberately no second signature column — one display URL, one asset id.
 *
 * PASSWORDS ARE NOT IN THIS FILE. Each entry names the env var holding its
 * password (`passwordEnv`) so this directory can be committed without shipping
 * live credentials. Put the values in `.env` (git-ignored) or export them for
 * the run. The import refuses to touch the database if any are missing.
 */
/** Shortest value accepted as a real password. Guards against dotenv truncation. */
export const MIN_PASSWORD_LENGTH = 8;

export interface CorporateUserSeed {
  name: string;
  email?: string;
  /** Env var holding this person's password. Never a literal. */
  passwordEnv: string;
  department: string;
  designation: string;
  role: "MD" | "DIRECTOR" | "COO" | "MANAGER";
  signatureImageUrl?: string;
  /**
   * Resolve the existing account by ROLE instead of by name.
   *
   * The three executive accounts were seeded with placeholder names
   * ("Managing Director", "System Administrator"), so they can only be matched
   * by the role they already hold.
   */
  matchByRole?: boolean;
}

export const CORPORATE_USERS: CorporateUserSeed[] = [
  {
    name: "Jashim Uddin Ahmed",
    email: "md@x-grouprestaurant.com",
    passwordEnv: "CORPORATE_PW_MD",
    department: "Management",
    designation: "MD",
    role: "MD",
    matchByRole: true,
  },
  {
    name: "Abid Uddin Ahmed",
    email: "director@x-grouprestaurant.com",
    passwordEnv: "CORPORATE_PW_DIRECTOR",
    department: "Management",
    designation: "Director",
    role: "DIRECTOR",
    matchByRole: true,
  },
  {
    name: "Mohammed Jahangir Alam",
    email: "coo@x-grouprestaurant.com",
    passwordEnv: "CORPORATE_PW_COO",
    department: "Management",
    designation: "Chief Operating Officer",
    role: "COO",
    matchByRole: true,
  },
  {
    name: "Md. Zilhaj Pervez",
    passwordEnv: "CORPORATE_PW_ZILHAJ",
    department: "F & B Service",
    designation: "Head of F & B Operations",
    role: "MANAGER",
  },
  {
    name: "Shaker ull Alam",
    passwordEnv: "CORPORATE_PW_SHAKER",
    department: "Kitchen",
    designation: "Executive Chef",
    role: "MANAGER",
  },
  {
    name: "Md. Habibur Rahman",
    passwordEnv: "CORPORATE_PW_HABIBUR",
    department: "Butchery",
    designation: "Head of Butcher",
    role: "MANAGER",
  },
  {
    name: "Muhammad Al Mamun",
    passwordEnv: "CORPORATE_PW_MAMUN",
    department: "Accounts",
    designation: "Manager, Accounts",
    role: "MANAGER",
  },
  {
    name: "Md Reasad Ahmed",
    passwordEnv: "CORPORATE_PW_REASAD",
    department: "IT & DM",
    designation: "Manager, Digital Marketing",
    role: "MANAGER",
  },
  {
    name: "Md. Mehedi Hasan Momin",
    passwordEnv: "CORPORATE_PW_MEHEDI",
    department: "HR & Admin",
    designation: "Head of HR and Admin",
    role: "MANAGER",
  },
  {
    name: "Md Arman Ali",
    passwordEnv: "CORPORATE_PW_ARMAN",
    department: "Store & Procurement",
    designation: "Head of Procurement",
    role: "MANAGER",
  },
  {
    name: "Md. Mujibur Rahaman",
    passwordEnv: "CORPORATE_PW_MUJIBUR",
    department: "Store & Procurement",
    designation: "GM, Purchase",
    role: "MANAGER",
  },
  {
    name: "Md. Abu Wahid",
    passwordEnv: "CORPORATE_PW_ABU",
    department: "Store & Procurement",
    designation: "Asstt. Manager Purchase",
    role: "MANAGER",
  },
  {
    name: "Md. Shohel Miah",
    passwordEnv: "CORPORATE_PW_SHOHEL",
    department: "Engineering",
    designation: "Technical Manager",
    role: "MANAGER",
  },
];

/**
 * Returns the env var names whose passwords are not available in this process.
 *
 * The import calls this BEFORE opening a transaction, so a missing password
 * fails loudly and leaves the database untouched — it must never half-apply.
 */
export function missingCorporatePasswords(
  people: CorporateUserSeed[] = CORPORATE_USERS,
): string[] {
  return people
    .map((p) => p.passwordEnv)
    .filter((key) => {
      const value = process.env[key];
      if (!value) return true;
      // dotenv treats an unquoted `#` as an inline comment, which silently
      // truncates a password to its first fragment (e.g. "Zp#6Vr8@Lm2" → "Zp").
      // A real password here is long; anything this short is a quoting bug.
      if (value.length < MIN_PASSWORD_LENGTH) {
        console.warn(
          `  ! ${key} looks truncated (${value.length} chars). Wrap it in double quotes in .env.`,
        );
        return true;
      }
      return false;
    });
}
