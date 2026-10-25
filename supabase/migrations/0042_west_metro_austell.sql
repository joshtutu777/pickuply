-- West Metro's fallback center is Austell 30106. East Gwinnett stays Lawrenceville 30043.
-- Drivers with no home ZIP are measured from that center. This records the rerun.

update public.zones as zone_row
set center_lat = centroid.lat, center_lng = centroid.lng
from public.ga_zip_centroids as centroid
where zone_row.slug = 'west_metro' and centroid.zip = '30106';

insert into public.audit_log (actor_id, action, target_type, target_id, data)
select
  null,
  'backfill_coverage_fallback',
  'driver',
  drivers.profile_id,
  jsonb_build_object(
    'radius_miles', 25,
    'fallback_zip', case when zones.slug = 'east_gwinnett' then '30043' else '30106' end,
    'reason', 'no home zip'
  )
from public.drivers
left join public.zones on zones.id = drivers.zone_id
where nullif(btrim(coalesce(drivers.home_zip, '')), '') is null;
