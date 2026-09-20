import type { Metadata } from 'next';

import { DocumentForm } from '../document-form';

export const metadata: Metadata = { title: 'New document' };

export default function NewDocumentPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10 md:px-10 md:py-14">
      <h1 className="text-[1.75rem] leading-tight font-semibold tracking-tight">
        New document
      </h1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        Saved first, then embedded — you will see whether it worked.
      </p>

      <div className="mt-10">
        <DocumentForm />
      </div>
    </div>
  );
}
