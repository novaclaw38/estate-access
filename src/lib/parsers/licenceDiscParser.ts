export interface SALicenceDiscData {
  discNumber: string;
  registrationNumber: string;
  vehicleRegisterNumber: string;
  description: string; // e.g. "HATCHBACK", "LIGHT LOAD VEHICLE"
  make: string;
  seriesName: string; // Model line (e.g. "HILUX", "COROLLA")
  color: string;
  vin: string;
  engineNumber: string;
  expiryDate: string; // YYYY-MM-DD
  issueDate: string; // YYYY-MM-DD
  rawPayload: string;
  isValid: boolean;
  isExpired: boolean;
}

/**
 * Decodes raw PDF417 barcode string scanned from a South African vehicle
 * licence disc. Disc strings are '%'-delimited:
 *
 * [0] Header / country identifier (e.g. "ZA" or blank control sequence)
 * [1] Licence Disc Number
 * [2] Vehicle Register Number
 * [3] Vehicle Registration Number (licence plate)
 * [4] Vehicle Description (body type)
 * [5] Make
 * [6] Series Name (model)
 * [7] Colour
 * [8] VIN / Chassis Number
 * [9] Engine Number
 * [10] Expiry Date
 * [11] Issue Date
 *
 * Real disc firmware varies (an unverifiable assumption without testing
 * against physical hardware) — `isValid` and `rawPayload` let a caller fall
 * back to manual entry rather than trusting a garbled parse.
 */
export function parseSALicenceDisc(rawInput: string): SALicenceDiscData {
  if (!rawInput || typeof rawInput !== "string") {
    return createEmptyResult(rawInput);
  }

  const cleanedInput = rawInput.trim();
  const parts = cleanedInput.split("%").map((p) => p.trim());

  if (parts.length < 10) {
    return createEmptyResult(cleanedInput);
  }

  // Handle potential offset shifts if the leading delimiter was omitted or included.
  const first = parts[0] ?? "";
  const offset = first.includes("ZA") || first === "" ? 1 : 0;

  const discNumber = parts[offset] ?? "";
  const vehicleRegisterNumber = parts[offset + 1] ?? "";
  const registrationNumber = cleanRegistration(parts[offset + 2] ?? "");
  const description = parts[offset + 3] ?? "";
  const make = parts[offset + 4] ?? "";
  const seriesName = parts[offset + 5] ?? "";
  const color = parts[offset + 6] ?? "";
  const vin = parts[offset + 7] ?? "";
  const engineNumber = parts[offset + 8] ?? "";
  const expiryRaw = parts[offset + 9] ?? "";
  const issueRaw = parts[offset + 10] ?? "";

  const expiryDate = formatDateString(expiryRaw);
  const issueDate = formatDateString(issueRaw);
  const isExpired = checkIsExpired(expiryDate);

  const isValid = discNumber.length >= 6 && registrationNumber.length >= 4 && vin.length >= 8;

  return {
    discNumber,
    registrationNumber,
    vehicleRegisterNumber,
    description,
    make,
    seriesName,
    color,
    vin,
    engineNumber,
    expiryDate,
    issueDate,
    rawPayload: cleanedInput,
    isValid,
    isExpired,
  };
}

function cleanRegistration(reg: string): string {
  return reg.replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

/** Normalizes YYYYMMDD / YYYY-MM-DD / YYYY/MM/DD into YYYY-MM-DD. */
function formatDateString(rawDate: string): string {
  if (!rawDate) return "";

  const digitsOnly = rawDate.replace(/\D/g, "");
  if (digitsOnly.length === 8) {
    return `${digitsOnly.slice(0, 4)}-${digitsOnly.slice(4, 6)}-${digitsOnly.slice(6, 8)}`;
  }
  return rawDate;
}

function checkIsExpired(expiryDateStr: string): boolean {
  if (!expiryDateStr) return false;
  const expiry = new Date(expiryDateStr);
  if (isNaN(expiry.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return expiry < today;
}

function createEmptyResult(raw: string): SALicenceDiscData {
  return {
    discNumber: "",
    registrationNumber: "",
    vehicleRegisterNumber: "",
    description: "",
    make: "",
    seriesName: "",
    color: "",
    vin: "",
    engineNumber: "",
    expiryDate: "",
    issueDate: "",
    rawPayload: raw || "",
    isValid: false,
    isExpired: false,
  };
}
