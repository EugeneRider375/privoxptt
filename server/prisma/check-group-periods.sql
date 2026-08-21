-- Проверка перед выкаткой D7 (сроки групп и права участников).
--
-- Поля Group.startsAt/endsAt/status заполнялись с 2026-08-18, но ни на что не
-- влияли — поэтому случайная дата в прошлом там ничем себя не проявляла бы.
-- После выкатки каждая такая группа замолчит: вход, PTT, звонки и сообщения
-- будут запрещены всем, включая диспетчеров и админов.
--
-- Запускать ДО деплоя. Пустой вывод обоих запросов = всё чисто, можно катить.
--
--   docker compose exec -T db psql -U privox -d privoxptt -f - < server/prisma/check-group-periods.sql
--
-- Починка (любой из вариантов):
--   update "Group" set "endsAt" = null where id = '<id>';                 -- сделать бессрочной
--   update "Group" set "endsAt" = '2027-01-01' where id = '<id>';         -- продлить
--   update "Group" set status = 'ACTIVE' where id = '<id>';               -- вернуть из DRAFT/ARCHIVED
-- Либо то же самое мышкой: админка → Groups → Edit → STATUS / STARTS AT / ENDS AT.

\echo '=== 1. Группы, которые ЗАМОЛЧАТ после выкатки ==='

select
  g.id,
  g.name,
  o.name                                        as organization,
  g.status,
  g."startsAt",
  g."endsAt",
  case
    when g.status = 'ARCHIVED'          then 'ARCHIVED'
    when g.status = 'DRAFT'             then 'DRAFT — не активирована'
    when g."startsAt" > now()           then 'ещё не началась'
    when g."endsAt"   < now()           then 'срок истёк'
  end                                           as reason,
  (select count(*) from "GroupMember" m where m."groupId" = g.id) as members
from "Group" g
join "Organization" o on o.id = g."organizationId"
where g.status <> 'ACTIVE'
   or g."startsAt" > now()
   or g."endsAt"   < now()
order by members desc, o.name, g.name;

\echo ''
\echo '=== 2. Группы, которые замолчат в ближайшие 30 дней (предупредить людей) ==='

select
  g.name,
  o.name                                        as organization,
  g."endsAt",
  date_trunc('day', g."endsAt" - now())         as remaining,
  (select count(*) from "GroupMember" m where m."groupId" = g.id) as members
from "Group" g
join "Organization" o on o.id = g."organizationId"
where g.status = 'ACTIVE'
  and g."endsAt" between now() and now() + interval '30 days'
order by g."endsAt";

\echo ''
\echo '=== 3. Участники с урезанными правами (проверить, что намеренно) ==='

select
  o.name    as organization,
  g.name    as "group",
  u.callsign,
  m."canSpeak",
  m."canMessage",
  m."canShareLocation"
from "GroupMember" m
join "Group" g        on g.id = m."groupId"
join "User" u         on u.id = m."userId"
join "Organization" o on o.id = g."organizationId"
where not m."canSpeak" or not m."canMessage" or not m."canShareLocation"
order by o.name, g.name, u.callsign;

\echo ''
\echo '=== 4. Пользователи с истёкшим сроком доступа (их выкинет из сокета) ==='

select
  o.name as organization,
  u.callsign,
  u.role,
  u."accessExpiresAt",
  u."isActive"
from "User" u
join "Organization" o on o.id = u."organizationId"
where u."accessExpiresAt" is not null
order by u."accessExpiresAt";
