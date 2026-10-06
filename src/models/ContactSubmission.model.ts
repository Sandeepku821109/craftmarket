import { query } from "../config/database";

export interface IContactSubmission {
  _id: string;
  id: string;
  name: string;
  phone: string;
  email: string;
  subject: string;
  query: string;
  status: "new" | "in-progress" | "resolved";
  createdAt: Date;
}

const CONTACT_FIELDS = `id AS "_id", id, name, phone, email, subject, query, status,
  created_at AS "createdAt"`;

export async function createContactSubmission(data: {
  name: string; phone: string; email: string; subject: string; query: string;
}): Promise<IContactSubmission> {
  const result = await query<IContactSubmission>(
    `INSERT INTO contact_submissions (name, phone, email, subject, query)
     VALUES ($1,$2,$3,$4,$5) RETURNING ${CONTACT_FIELDS}`,
    [data.name.trim(), data.phone.trim(), data.email.trim().toLowerCase(), data.subject, data.query.trim()]
  );
  return result.rows[0];
}

export async function listContactSubmissions(): Promise<IContactSubmission[]> {
  const result = await query<IContactSubmission>(
    `SELECT ${CONTACT_FIELDS} FROM contact_submissions ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function updateContactSubmissionStatus(
  id: string,
  status: IContactSubmission["status"]
): Promise<IContactSubmission | null> {
  const result = await query<IContactSubmission>(
    `UPDATE contact_submissions SET status = $2, updated_at = now()
     WHERE id = $1 RETURNING ${CONTACT_FIELDS}`,
    [id, status]
  );
  return result.rows[0] ?? null;
}

export async function deleteContactSubmission(id: string): Promise<boolean> {
  const result = await query("DELETE FROM contact_submissions WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}
