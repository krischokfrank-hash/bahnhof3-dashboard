# Bahnhof3 Mieter Dashboard (Sichere Variante)

Dieses Dashboard nutzt **nur** die sichere RPC `get_my_energy_15min`.
Direkte Tabellenabfragen aus dem Browser sind deaktiviert.

## Projektpfad
`C:\Temp\bahnhof3-dashboard`

## 1) Supabase SQL Setup ausfuehren
Datei:
- `C:\Temp\bahnhof3-dashboard\supabase_secure_setup.sql`

In Supabase:
1. `SQL Editor` oeffnen
2. Inhalt der Datei `supabase_secure_setup.sql` ausfuehren

Das Script erstellt:
- `public.tenant_profiles` (`user_id`, `apartment`, `role`)
- RLS-Policy fuer Profile
- RPC `public.get_my_energy_15min(...)`
- Entzug direkter SELECT-Rechte auf `energy_simulation_2025_15min` fuer `anon/authenticated`

## 2) Mieter/Admin den Wohnungen zuordnen
Pro User in `auth.users` genau einen Eintrag in `tenant_profiles` anlegen.

Beispiel:
```sql
insert into public.tenant_profiles (user_id, apartment, role)
values ('<AUTH_USER_UUID>', 'apt1', 'tenant');

insert into public.tenant_profiles (user_id, apartment, role)
values ('<ADMIN_UUID>', 'apt1', 'admin');
```

## 3) Dashboard starten
1. `cd C:\Temp\bahnhof3-dashboard`
2. `python -m http.server 8080`
3. Browser: `http://localhost:8080`

## Verhalten
- Tenant: sieht nur eigene Wohnung
- Admin: kann `apt1..apt4` wechseln
- Datenquelle: RPC `get_my_energy_15min`

## Keys
- Im Frontend werden `Supabase URL` und `anon key` aus `config.js` geladen.
- `service_role` Key niemals im Browser verwenden.

