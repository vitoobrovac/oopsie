begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipt-scan-feedback', 'receipt-scan-feedback', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp']);

create policy receipt_feedback_upload_own_folder on storage.objects
for insert to authenticated with check (
  bucket_id = 'receipt-scan-feedback'
  and storage.foldername(name) = array[(select auth.uid())::text]
  and storage.filename(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
);

create policy receipt_feedback_staff_reads_only on storage.objects
as restrictive for select to anon, authenticated
using (bucket_id <> 'receipt-scan-feedback');

commit;
