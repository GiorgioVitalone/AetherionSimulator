-- cards-balance-v2.sql — Aetherion starter-deck rebalance (skill-aware method)
-- Baseline: RAW "Cards" table (live DB export == sim-data/aetherion-cards.json).
-- Ruleset: ruleset-v1 (all 9 locked rules). Measured at the validated r8d3 rung via
-- paired comparison (common random numbers). Stats/cost are ABSOLUTE targets (idempotent).
-- 32 cards changed.

BEGIN;

-- Ghoul Marshal (id 9) [Onyx]: hp 3->2
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '2') WHERE id = 9;

-- Zombie Horde (id 11) [Onyx]: hp 5->4, mana 5->4
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '4') WHERE id = 11;
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '4') WHERE id = 11;

-- Skeletal Guardian (id 16) [Onyx]: hp 4->3, mana 5->4
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '3') WHERE id = 16;
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '4') WHERE id = 16;

-- Morgath, the Undying (id 17) [Onyx]: hp 4->3, atk 4->3
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '3') WHERE id = 17;
UPDATE "Cards" SET stats = jsonb_set(stats, '{atk}', '3') WHERE id = 17;

-- Dark Bond (id 20) [Onyx]: mana 3->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 20;

-- Necrotic Revival (id 28) [Onyx]: mana 4->3
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '3') WHERE id = 28;

-- Plague Burst (id 31) [Onyx]: mana 5->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 31;

-- Haunting (id 38) [Onyx]: mana 5->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 38;

-- Protector of Faith (id 47) [Radiant]: atk 1->2
UPDATE "Cards" SET stats = jsonb_set(stats, '{atk}', '2') WHERE id = 47;

-- Shieldbearer Paladin (id 48) [Radiant]: hp 3->2
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '2') WHERE id = 48;

-- Faithkeeper of Dawn (id 49) [Radiant]: hp 4->2
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '2') WHERE id = 49;

-- Radiant Angel (id 51) [Radiant]: atk 3->4
UPDATE "Cards" SET stats = jsonb_set(stats, '{atk}', '4') WHERE id = 51;

-- Archon's Guardian (id 53) [Radiant]: hp 3->2
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '2') WHERE id = 53;

-- Archon of Order, Uriel (id 54) [Radiant]: hp 4->3
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '3') WHERE id = 54;

-- Heavenly Chorus (id 64) [Radiant]: mana 5->3
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '3') WHERE id = 64;

-- Celestial Aegis (id 72) [Radiant]: mana 5->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 72;

-- Arcane Scholar (id 75) [Sapphire]: mana 2->1
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '1') WHERE id = 75;

-- Sapphire Sentinel (id 76) [Sapphire]: mana 2->3
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '3') WHERE id = 76;

-- Crystal Golem (id 78) [Sapphire]: hp 3->2
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '2') WHERE id = 78;

-- Illusionist Adept (id 79) [Sapphire]: mana 3->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 79;

-- Arcane Echoes (id 94) [Sapphire]: mana 5->1
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '1') WHERE id = 94;

-- Lens of Foresight (id 100) [Sapphire]: mana 3->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 100;

-- Vinecall Elder (id 110) [Verdant]: energy 5->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{energy}', '2') WHERE id = 110;

-- Biosteel Golem (id 111) [Verdant]: energy 8->6
UPDATE "Cards" SET cost = jsonb_set(cost, '{energy}', '6') WHERE id = 111;

-- Guardian Spirit MK-III (id 113) [Verdant]: energy 8->6
UPDATE "Cards" SET cost = jsonb_set(cost, '{energy}', '6') WHERE id = 113;

-- Biomass Surge (id 122) [Verdant]: energy 5->3
UPDATE "Cards" SET cost = jsonb_set(cost, '{energy}', '3') WHERE id = 122;

-- Tech Bloom (id 123) [Verdant]: energy 5->4
UPDATE "Cards" SET cost = jsonb_set(cost, '{energy}', '4') WHERE id = 123;

-- Shadowlord Kaelthar (id 133) [Onyx]: hp 25->30
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '30') WHERE id = 133;

-- Shieldbearer Seraphina (id 134) [Radiant]: hp 35->30
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '30') WHERE id = 134;

-- RIA-09 (id 136) [Verdant]: hp 33->30
UPDATE "Cards" SET stats = jsonb_set(stats, '{hp}', '30') WHERE id = 136;

-- Bone Devourer (id 138) [Onyx]: mana 3->2
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '2') WHERE id = 138;

-- Master Archivist (id 141) [Sapphire]: mana 6->3
UPDATE "Cards" SET cost = jsonb_set(cost, '{mana}', '3') WHERE id = 141;

COMMIT;
