do $$
begin
  if exists (select 1 from public.roles where id = '00000000-0000-0000-0000-000000000011') then
    raise exception 'MT4_ISOLAMENTO: papel estrangeiro visível';
  end if;
end $$;
