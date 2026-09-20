import { redirect } from 'next/navigation';

/** Signed-in visitors land on their documents; the proxy handles the rest. */
export default function RootPage() {
  redirect('/documents');
}
