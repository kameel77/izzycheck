/**
 * Issuer / Company configuration for IzzyCheck generated documents.
 * Can be overridden via environment variables.
 */
export const ISSUER_CONFIG = {
  companyName: process.env.ISSUER_COMPANY_NAME || "Izzy Lease Sp. z o.o.",
  taxId: process.env.ISSUER_TAX_ID || "5213904562",
  website: process.env.ISSUER_WEBSITE || "www.izzylease.pl",
  address: process.env.ISSUER_ADDRESS || "ul. Domaniewska 37, 02-672 Warszawa",
  contactEmail: process.env.ISSUER_CONTACT_EMAIL || "kontakt@izzylease.pl",
};
