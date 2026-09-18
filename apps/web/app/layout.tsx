import type { Metadata } from 'next';
import './globals.css';
import { Courier_Prime, Work_Sans } from 'next/font/google';
import { cn } from '@/lib/utils';

const workSans = Work_Sans({ subsets: ['latin'], variable: '--font-sans' });
const courierPrime = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-display',
});

// Both auth routes set their own title and description; this is the fallback for
// anything that does not, such as the not-found page.
export const metadata: Metadata = {
  title: { default: 'Knowledge base', template: '%s' },
  description: 'Ask questions of everything you have written down.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn('font-sans', workSans.variable, courierPrime.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
