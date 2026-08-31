import type { Metadata } from 'next';
import './globals.css';

const title = 'Clear Weather — No ads. Just weather.';
const description = 'Today, recent radar, and the next ten days on one calm, clutter-free page.';

export const metadata: Metadata = {
  title,
  description,
  applicationName: 'Clear Weather',
  openGraph: {
    type: 'website',
    title,
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
