// Server-side EmailJS config for the PI-send endpoint. serviceId/publicKey should
// point at the same EmailJS account as EMAILJS_CONFIG in src/App.jsx — piTemplateId
// is a separate template (line-items layout doesn't fit the lead-notification one)
// created in the EmailJS dashboard. The access token proving server-side sends is
// EMAILJS_PRIVATE_KEY (Vercel env var, from EmailJS dashboard -> Account -> API Keys),
// never exposed to the browser.
export const EMAILJS_CONFIG = {
  serviceId: 'REPLACE_WITH_SERVICE_ID',
  piTemplateId: 'REPLACE_WITH_PI_TEMPLATE_ID',
  publicKey: 'REPLACE_WITH_PUBLIC_KEY',
};
