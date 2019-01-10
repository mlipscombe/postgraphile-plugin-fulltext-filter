const { graphql } = require('graphql');
const { withSchema } = require('./helpers');

test(
  'table with unfiltered full-text field works',
  withSchema({
    setup: `
      create table fulltext_test.job (
        id serial primary key,
        name text not null,
        full_text tsvector
      );
      insert into fulltext_test.job (name, full_text) values 
        ('test', to_tsvector('apple fruit')), 
        ('test 2', to_tsvector('banana fruit'));
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        query {
          allJobs {
            nodes {
              id
              name
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');
    },
  }),
);

test(
  'fulltext search field is created',
  withSchema({
    setup: `
      create table fulltext_test.job (
        id serial primary key,
        name text not null,
        full_text tsvector
      );
      insert into fulltext_test.job (name, full_text) values 
        ('test', to_tsvector('apple fruit')), 
        ('test 2', to_tsvector('banana fruit'));
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        query {
          allJobs(
            filter: {
              fullText: {
                matches: "fruit"
              }
            }
            orderBy: [
              FULL_TEXT_RANK_ASC 
            ]
          ) {
            nodes {
              id
              name
              fullTextRank
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.allJobs.nodes;
      expect(data).toHaveLength(2);
      data.map(n => expect(n.fullTextRank).not.toBeNull());

      const bananaQuery = `
        query {
          allJobs(
            filter: {
              fullText: {
                matches: "banana"
              }
            }
          ) {
            nodes {
              id
              name
              fullTextRank
            }
          }
        }
      `;
      const bananaResult = await graphql(schema, bananaQuery, null, { pgClient });
      expect(bananaResult).not.toHaveProperty('errors');

      const bananaData = bananaResult.data.allJobs.nodes;
      expect(bananaData).toHaveLength(1);
      bananaData.map(n => expect(n.fullTextRank).not.toBeNull());
    },
  }),
);

test(
  'querying rank without filter works',
  withSchema({
    setup: `
      create table fulltext_test.job (
        id serial primary key,
        name text not null,
        full_text tsvector
      );
      insert into fulltext_test.job (name, full_text) values 
        ('test', to_tsvector('apple fruit')), 
        ('test 2', to_tsvector('banana fruit'));
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        query {
          allJobs {
            nodes {
              id
              name
              fullTextRank
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.allJobs.nodes;
      expect(data).toHaveLength(2);
      data.map(n => expect(n.fullTextRank).toBeNull());
    },
  }),
);

test(
  'fulltext search field is created',
  withSchema({
    setup: `
      create table fulltext_test.job (
        id serial primary key,
        name text not null,
        full_text tsvector,
        other_full_text tsvector
      );
      insert into fulltext_test.job (name, full_text, other_full_text) values 
        ('test', to_tsvector('apple fruit'), to_tsvector('vegetable potato')), 
        ('test 2', to_tsvector('banana fruit'), to_tsvector('vegetable pumpkin'));
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        query {
          allJobs(
            filter: {
              fullText: {
                matches: "fruit"
              }
              otherFullText: {
                matches: "vegetable"
              }
            }
            orderBy: [
              FULL_TEXT_RANK_ASC
              OTHER_FULL_TEXT_DESC
            ]
          ) {
            nodes {
              id
              name
              fullTextRank
              otherFullTextRank
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const result = await graphql(schema, query, null, { pgClient });
      expect(result).not.toHaveProperty('errors');

      const data = result.data.allJobs.nodes;
      expect(data).toHaveLength(2);
      data.map(n => expect(n.fullTextRank).not.toBeNull());
      data.map(n => expect(n.otherFullTextRank).not.toBeNull());

      const potatoQuery = `
        query {
          allJobs(
            filter: {
              otherFullText: {
                matches: "potato"
              }
            }
          ) {
            nodes {
              id
              name
              fullTextRank
              otherFullTextRank
            }
          }
        }
      `;
      const potatoResult = await graphql(schema, potatoQuery, null, { pgClient });
      expect(potatoResult).not.toHaveProperty('errors');

      const potatoData = potatoResult.data.allJobs.nodes;
      expect(potatoData).toHaveLength(1);
      potatoData.map(n => expect(n.fullTextRank).toBeNull());
      potatoData.map(n => expect(n.otherFullTextRank).not.toBeNull());
    },
  }),
);

test(
  'sort by full text rank field works',
  withSchema({
    setup: `
      create table fulltext_test.job (
        id serial primary key,
        name text not null,
        full_text tsvector
      );
      insert into fulltext_test.job (name, full_text) values 
        ('test', to_tsvector('apple fruit')), 
        ('test 2', to_tsvector('banana fruit'));
    `,
    test: async ({ schema, pgClient }) => {
      const query = `
        query orderByQuery($orderBy: [JobsOrderBy!]!) {
          allJobs(
            filter: {
              fullText: {
                matches: "fruit | banana"
              }
            }
            orderBy: $orderBy
          ) {
            nodes {
              id
              name
              fullTextRank
            }
          }
        }
      `;
      expect(schema).toMatchSnapshot();

      const ascResult = await graphql(schema, query, null, { pgClient }, { orderBy: ['FULL_TEXT_ASC'] });
      expect(ascResult).not.toHaveProperty('errors');

      const descResult = await graphql(schema, query, null, { pgClient }, { orderBy: ['FULL_TEXT_DESC'] });
      expect(descResult).not.toHaveProperty('errors');

      expect(ascResult).not.toEqual(descResult);
    },
  }),
);
