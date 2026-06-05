// Stubs Supabase REST/Auth so we can drive the real UI + family-chart library
// without a live backend. Proves: tree renders, the edit form shows readable
// multilingual labels, and a save PATCHes the correctly-shaped payload (this is
// the path the chart.getStore() bug used to crash).
//
// Run: start the dev server (yarn app:dev, port 5173) with a .env containing
// placeholder VITE_SUPABASE_URL/ANON_KEY/TREE_ID, then `yarn cypress run
// --spec cypress/e2e/app-smoke.cy.js`. Requires the Cypress binary + a browser.
const TREE_ID = '00000000-0000-0000-0000-000000000000';

function stubSupabase() {
  cy.intercept('GET', '**/auth/v1/user*', {
    statusCode: 200,
    body: { id: 'u1', email: 'owner@example.com' }
  });
  // Role probe: owner row
  cy.intercept('GET', '**/rest/v1/allowed_emails*', {
    statusCode: 200, body: [{ role: 'owner' }]
  });
  cy.intercept('GET', '**/rest/v1/trees*', {
    statusCode: 200, body: { id: TREE_ID, name: 'Test', default_language: 'en' }
  });
  // Tree data: one person
  cy.intercept('GET', '**/rest/v1/tree_data*', {
    statusCode: 200,
    body: {
      id: 't1', tree_id: TREE_ID, version: 1, data_version: 1,
      updated_at: new Date().toISOString(), updated_by: null,
      data: [{ id: 'p1', data: { names: { en: { first: 'Root', last: 'Person' } } },
               rels: { parents: [], spouses: [], children: [] } }]
    }
  });
  cy.intercept('GET', '**/rest/v1/access_requests*', { statusCode: 200, body: [] });
  // Capture the save
  cy.intercept('PATCH', '**/rest/v1/tree_data*', (req) => {
    req.reply({ statusCode: 200, body: { ...req.body, id: 't1', tree_id: TREE_ID, version: 2 } });
  }).as('saveTree');
}

describe('app smoke', () => {
  beforeEach(() => {
    stubSupabase();
  });

  it('renders the tree and shows labeled multilingual fields', () => {
    cy.visit('/');
    cy.contains('Root').should('exist');
    // Open the edit form on the main card
    cy.get('.card_cont, .card').first().click();
    // Readable labels (Task 3 fix), not raw ids
    cy.contains('First name (English)').should('exist');
    cy.contains(/繁體/).should('exist');
    cy.get('[name="first_name__zh-Hant"]').should('exist');
  });

  it('saves an edit with the correctly-shaped payload', () => {
    cy.visit('/');
    cy.get('.card_cont, .card').first().click();
    cy.get('[name="first_name__zh-Hant"]').clear().type('根');
    cy.get('form#familyForm button[type="submit"]').click();
    cy.wait('@saveTree').then(({ request }) => {
      const body = request.body;
      const people = Array.isArray(body) ? body : body.data;
      const p1 = people.find((p) => p.id === 'p1');
      expect(p1.data.names['zh-Hant'].first).to.eq('根'); // round-tripped into names map
      expect(p1.data).to.not.have.property('first_name');  // flat fields stripped
      expect(body.version).to.eq(2);                       // optimistic bump
    });
  });
});
