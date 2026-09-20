import { z } from 'zod';

/** Matches the `documents_title_length` constraint in the migration. */
export const MAX_TITLE_LENGTH = 200;
/** Matches `documents_content_length`. An upper bound on one paste's cost. */
export const MAX_CONTENT_LENGTH = 1_000_000;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

export const documentTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TAG_LENGTH)
  .toLowerCase();

/**
 * Whether this document's chunks are current.
 *
 * Surfaced to the client because embedding depends on a third party and can
 * fail independently of the write. A document that saved fine but is missing
 * from every answer is a confusing thing to debug from the outside.
 */
export const indexingStatusSchema = z.enum(['pending', 'indexed', 'failed']);

export type IndexingStatus = z.infer<typeof indexingStatusSchema>;

export const documentIndexingSchema = z.object({
  status: indexingStatusSchema,
  /** When the current content was embedded; null if it never was. */
  indexedAt: z.string().nullable(),
  /** Why the last attempt failed, for display and for deciding to retry. */
  error: z.string().nullable(),
  /** How many chunks the document produced. Null unless known. */
  chunkCount: z.number().int().nonnegative().nullable(),
});

export type DocumentIndexing = z.infer<typeof documentIndexingSchema>;

/** A document as the API returns it: camelCase, timestamps as ISO strings. */
export const documentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  indexing: documentIndexingSchema,
});

export type Document = z.infer<typeof documentSchema>;

/** A document without its body, for list views that never render content. */
export const documentSummarySchema = documentSchema.omit({ content: true });

export type DocumentSummary = z.infer<typeof documentSummarySchema>;

/**
 * The editable fields, shared by create and update.
 *
 * Deriving the update schema with `createDocumentSchema.partial()` would be
 * shorter but wrong: `.partial()` makes a field optional without dropping its
 * default, so `tags` would materialise as `[]` on a PATCH that never mentioned
 * it and silently clear the document's tags.
 */
const documentFields = {
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH),
  tags: z.array(documentTagSchema).max(MAX_TAGS),
};

export const createDocumentSchema = z.object({
  ...documentFields,
  // Absent tags on create mean "none", which is a sensible default. Absent
  // tags on update mean "leave them alone", which is why update has no default.
  tags: documentFields.tags.default([]),
});

export type CreateDocument = z.infer<typeof createDocumentSchema>;

/**
 * Every field optional, but not all of them at once — an empty PATCH is a
 * caller mistake worth reporting rather than a no-op that returns 200.
 */
export const updateDocumentSchema = z
  .object({
    title: documentFields.title.optional(),
    content: documentFields.content.optional(),
    tags: documentFields.tags.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateDocument = z.infer<typeof updateDocumentSchema>;

export const listDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Narrows to documents carrying this tag, served by the GIN index. */
  tag: documentTagSchema.optional(),
});

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

export const documentListSchema = z.object({
  documents: z.array(documentSummarySchema),
  /** Total matching the filter, ignoring limit/offset. */
  total: z.number().int().nonnegative(),
});

export type DocumentList = z.infer<typeof documentListSchema>;
