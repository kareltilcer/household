-- The conformance module's tables, published for PowerSync (plan item 13): as a module's migration
-- calls replicate on every table a generated stream reads, so that the suite's streams, generated
-- with every other entity's, replicate from the publication the server's do. The tables of the
-- entities whose visibility and audience streams item 14 generates are published now, so that their
-- streams find them there.

-- +goose Up
SELECT replicate('conformance_items');
SELECT replicate('conformance_item_checks');
SELECT replicate('conformance_readings');
SELECT replicate('conformance_budgets');
SELECT replicate('conformance_notes');
SELECT replicate('conformance_chores');
SELECT replicate('conformance_completions');
SELECT replicate('conformance_attachments');
SELECT replicate('conformance_conversations');
SELECT replicate('conformance_conversation_members');
SELECT replicate('conformance_messages');
