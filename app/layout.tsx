import type { Metadata } from 'next';
import './globals.css';

const title = 'Clear Weather — No ads. Just weather.';
const description = 'Today, recent radar, and the next ten days on one calm, clutter-free page.';
const productionUrl = 'https://clear-weather.rtsoliday123.chatgpt.site';
const socialImageUrl = productionUrl + '/og.png';

export const metadata: Metadata = {
  metadataBase: new URL(productionUrl),
  title,
  description,
  applicationName: 'Clear Weather',
  alternates: { canonical: productionUrl },
  openGraph: {
    type: 'website',
    url: productionUrl,
    title,
    description,
    images: [{ url: socialImageUrl, width: 1731, height: 909, alt: 'Clear Weather — today, recent radar, and the next ten days.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [socialImageUrl],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
