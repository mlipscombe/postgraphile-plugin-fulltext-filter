const { graphql } = require('graphql');
const { withSchema } = require('./helpers');

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
