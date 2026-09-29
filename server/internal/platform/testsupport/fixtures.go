package testsupport

// InsertHousehold is the statement that makes a household whose id is $1, for a test that arranges
// rows under it without caring about its settings: a Czech household with a household code of its
// own. The tenant root is written only in its own context, so a test runs it as the administrator,
// who passes every policy, or with app.household_id set to $1.
const InsertHousehold = `
	INSERT INTO households (id, name, country, timezone, base_currency, locale, units, first_day_of_week, join_code)
	VALUES ($1, 'Test', 'CZ', 'Europe/Prague', 'CZK', 'cs', 'metric', 1,
	        translate(upper(substr(md5(random()::text), 1, 8)), '01', 'GH'))`

// InsertMember is the statement that makes the user $2 a member of household $1 with the role $3,
// under a membership id of its own.
const InsertMember = `INSERT INTO memberships (id, household_id, user_id, role) VALUES (gen_random_uuid(), $1, $2, $3)`

// InsertEnablement is the statement that enables the module $2 in household $1, or disables it,
// as $3 says.
const InsertEnablement = `INSERT INTO module_enablement (id, household_id, module, enabled) VALUES (gen_random_uuid(), $1, $2, $3)`
