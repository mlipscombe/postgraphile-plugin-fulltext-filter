const tsquery = require('pg-tsquery');
const { omit } = require('graphile-build-pg');

const TSVECTOR_TYPE_ID = 3614;
const tsquery = require('pg-tsquery');
const { omit } = require('graphile-build-pg');

const TSVECTOR_TYPE_ID = 3614;

export const PostGraphileFulltextFilterPlugin = (builder) => {
  builder.hook('inflection', (inflection, build) =>
    build.extend(inflection, {
      fullTextScalarTypeName() {
        return 'FullText';
      },
      pgTsvRank(fieldName) {
        return this.camelCase(`${fieldName}-rank`);
      },
      pgTsvOrderByColumnRankEnum(table, attr, ascending) {
        const columnName = attr.kind === 'procedure'
          ? attr.name.substr(table.name.length + 1)
          : this._columnName(attr, { skipRowId: true }); // eslint-disable-line no-underscore-dangle
        return this.constantCase(`${columnName}_rank_${ascending ? 'asc' : 'desc'}`);
      },
    }));

  builder.hook('build', (build) => {
    const {
      addConnectionFilterOperator,
      addType,
      getTypeByName,
      connectionFilterOperators,
      pgSql: sql,
      pgRegisterGqlTypeByTypeId: registerGqlTypeByTypeId,
      pgRegisterGqlInputTypeByTypeId: registerGqlInputTypeByTypeId,
      graphql: {
        GraphQLInputObjectType, GraphQLString, GraphQLScalarType,
      },
      inflection,
    } = build;

    if (!(addConnectionFilterOperator instanceof Function)) {
      throw new Error('PostGraphileFulltextFilterPlugin requires PostGraphileConnectionFilterPlugin to be loaded before it.');
    }

    const scalarName = inflection.fullTextScalarTypeName();

    const FullText = new GraphQLScalarType({
      name: scalarName,
      serialize(value) {
        return value;
      },
      parseValue(value) {
        return value;
      },
      parseLiteral(lit) {
        return lit;
      },
    });

    registerGqlTypeByTypeId(TSVECTOR_TYPE_ID, () => FullText);
    registerGqlInputTypeByTypeId(TSVECTOR_TYPE_ID, () => FullText);

    addConnectionFilterOperator(
      'matches',
      'Performs a full text search on the field.',
      () => GraphQLString,
      (identifier, val, fieldName, queryBuilder) => {
        const tsQueryString = tsquery(val);
        queryBuilder.select(
          sql.query`ts_rank(${identifier}, to_tsquery(${sql.value(tsQueryString)}))`,
          `__${fieldName}Rank`,
        );
        return sql.query`${identifier} @@ to_tsquery(${sql.value(tsQueryString)})`;
      },
      {
        allowedFieldTypes: [scalarName],
        resolveWithRawInput: true,
      },
    );

    const FullTextFilter = new GraphQLInputObjectType({
      name: 'FullTextFilter',
      description: 'A filter to be used against `FullText` fields.',
      fields: () => {
        const operator = connectionFilterOperators.matches;
        return {
          matches: {
            description: operator.description,
            type: operator.resolveType(getTypeByName(scalarName)),
          },
        };
      },
    }, {
      isPgTSVFilterInputType: true,
    });
    addType(FullTextFilter);

    return build;
  });

  builder.hook('GraphQLObjectType:fields', (fields, build, context) => {
    const {
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      pg2gql,
      graphql: { GraphQLFloat },
      pgColumnFilter,
      inflection,
    } = build;

    const {
      scope: { isPgRowType, isPgCompoundType, pgIntrospection: table },
      fieldWithHooks,
    } = context;

    if (
      !(isPgRowType || isPgCompoundType) ||
      !table ||
      table.kind !== 'class'
    ) {
      return fields;
    }

    const tableType = introspectionResultsByKind.type
      .filter(type =>
        type.type === 'c' &&
        type.namespaceId === table.namespaceId &&
        type.classId === table.id)[0];
    if (!tableType) {
      throw new Error('Could not determine the type of this table.');
    }

    const tsvColumns = introspectionResultsByKind.attribute
      .filter(attr => attr.classId === table.id)
      .filter(attr => parseInt(attr.typeId, 10) === TSVECTOR_TYPE_ID)
      .filter(attr => pgColumnFilter(attr, build, context))
      .filter(attr => !omit(attr, 'filter'));

    const tsvProcs = introspectionResultsByKind.procedure
      .filter(proc => proc.isStable)
      .filter(proc => proc.namespaceId === table.namespaceId)
      .filter(proc => proc.name.startsWith(`${table.name}_`))
      .filter(proc => proc.argTypeIds.length > 0)
      .filter(proc => proc.argTypeIds[0] === tableType.id)
      .filter(proc => parseInt(proc.returnTypeId, 10) === TSVECTOR_TYPE_ID)
      .filter(proc => !omit(proc, 'filter'));

    if (tsvColumns.length === 0 && tsvProcs.length === 0) {
      return fields;
    }

    const newRankField = (baseFieldName, rankFieldName) =>
      fieldWithHooks(
        rankFieldName,
        {
          description: `Full-text search ranking when filtered by \`${baseFieldName}\`.`,
          type: GraphQLFloat,
          resolve: data => pg2gql(data[`__${baseFieldName}Rank`], GraphQLFloat),
        },
        {},
      );

    const tsvFields = tsvColumns
      .reduce((memo, attr) => {
        const fieldName = inflection.column(attr);
        const rankFieldName = inflection.pgTsvRank(fieldName);
        memo[rankFieldName] = newRankField(fieldName, rankFieldName); // eslint-disable-line no-param-reassign

        return memo;
      }, {});

    const tsvProcFields = tsvProcs
      .reduce((memo, proc) => {
        const psuedoColumnName = proc.name.substr(table.name.length + 1);
        const fieldName = inflection.computedColumn(psuedoColumnName, proc, table);
        const rankFieldName = inflection.pgTsvRank(fieldName);
        memo[rankFieldName] = newRankField(fieldName, rankFieldName); // eslint-disable-line no-param-reassign

        return memo;
      }, {});

    return Object.assign({}, fields, tsvFields, tsvProcFields);
  });

  builder.hook('GraphQLEnumType:values', (values, build, context) => {
    const {
      extend,
      pgSql: sql,
      pgColumnFilter,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      inflection,
    } = build;
    const { scope: { isPgRowSortEnum, pgIntrospection: table } } = context;
    if (!isPgRowSortEnum || !table || table.kind !== 'class') {
      return values;
    }

    const tableType = introspectionResultsByKind.type
      .filter(type =>
        type.type === 'c' &&
        type.namespaceId === table.namespaceId &&
        type.classId === table.id)[0];
    if (!tableType) {
      throw new Error('Could not determine the type of this table.');
    }

    const tsvColumns = introspectionResultsByKind.attribute
      .filter(attr => attr.classId === table.id)
      .filter(attr => parseInt(attr.typeId, 10) === TSVECTOR_TYPE_ID);

    const tsvProcs = introspectionResultsByKind.procedure
      .filter(proc => proc.isStable)
      .filter(proc => proc.namespaceId === table.namespaceId)
      .filter(proc => proc.name.startsWith(`${table.name}_`))
      .filter(proc => proc.argTypeIds.length === 1)
      .filter(proc => proc.argTypeIds[0] === tableType.id)
      .filter(proc => parseInt(proc.returnTypeId, 10) === TSVECTOR_TYPE_ID)
      .filter(proc => !omit(proc, 'order'));


    if (tsvColumns.length === 0 && tsvProcs.length === 0) {
      return values;
    }

    return extend(
      values,
      tsvColumns
        .concat(tsvProcs)
        .filter(attr => pgColumnFilter(attr, build, context))
        .filter(attr => !omit(attr, 'order'))
        .reduce((memo, attr) => {
          const fieldName = attr.kind === 'procedure'
            ? inflection.computedColumn(attr.name.substr(table.name.length + 1), attr, table)
            : inflection.column(attr);
          const ascFieldName = inflection.pgTsvOrderByColumnRankEnum(table, attr, true);
          const descFieldName = inflection.pgTsvOrderByColumnRankEnum(table, attr, false);

          const findExpr = ({ queryBuilder }) => {
            const expr = queryBuilder.data.select.filter(obj => obj[1] === `__${fieldName}Rank`);
            return expr.length ? expr.shift()[0] : sql.fragment`1`;
          };

          memo[ascFieldName] = { // eslint-disable-line no-param-reassign
            value: {
              alias: `${ascFieldName.toLowerCase()}`,
              specs: [[findExpr, true]],
            },
          };
          memo[descFieldName] = { // eslint-disable-line no-param-reassign
            value: {
              alias: `${descFieldName.toLowerCase()}`,
              specs: [[findExpr, false]],
            },
          };

          return memo;
        }, {}),
      `Adding TSV rank columns for sorting on table '${table.name}'`,
    );
  });
};
