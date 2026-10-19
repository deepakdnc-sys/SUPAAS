-- Safe cumulative entry count. Row lock prevents two gate phones from admitting more than the limit.
create or replace function public.record_pass_entry(p_qr_token text, p_members integer)
returns table (entered_members integer, allowed_members integer)
language plpgsql
security definer
set search_path = public
as $$
declare r public.event_passes%rowtype;
begin
  if p_members < 1 or p_members > 4 then raise exception 'PASS_INVALID_MEMBER_COUNT'; end if;
  select * into r from public.event_passes where qr_token = p_qr_token for update;
  if not found then raise exception 'PASS_UNKNOWN_QR'; end if;
  if r.status <> 'APPROVED' then raise exception 'PASS_TICKET_NOT_ACTIVE'; end if;
  if r.entered_members + p_members > r.allowed_members then raise exception 'PASS_MEMBER_LIMIT_EXCEEDED'; end if;
  update public.event_passes set entered_members = entered_members + p_members, last_entry_at = now()
    where id = r.id returning event_passes.entered_members, event_passes.allowed_members into entered_members, allowed_members;
  return next;
end;
$$;
revoke all on function public.record_pass_entry(text, integer) from public, anon, authenticated;
grant execute on function public.record_pass_entry(text, integer) to service_role;
