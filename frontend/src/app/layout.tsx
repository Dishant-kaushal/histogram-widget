import type { Metadata } from "next";
import "@faclon-labs/design-sdk/styles.css";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Histogram Widget",
  description: "IOsense Histogram Widget — IO Lens v2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
