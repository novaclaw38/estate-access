import type { Metadata, Viewport } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Guard Terminal - Access Control",
  description: "Estate Visitor Access & Licence Disc Verification Terminal",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Guard Terminal",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // prevents accidental pinch-zoom on the kiosk tablet
};

// Scoped to /gate/* only: the rest of the site (resident pass requests) is
// a normal zoomable, light-themed page and shouldn't inherit kiosk chrome.
export default function GateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark bg-slate-950 text-slate-100 antialiased select-none">
      {children}
      <Script id="register-guard-terminal-sw" strategy="afterInteractive">
        {`
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(
                function(registration) {
                  console.log('Guard Terminal SW registered:', registration.scope);
                },
                function(err) {
                  console.error('Guard Terminal SW registration failed:', err);
                }
              );
            });
          }
        `}
      </Script>
    </div>
  );
}
