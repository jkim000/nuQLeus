const { makeExecutableSchema } = require('@graphql-tools/schema')
const { applyMiddleware } = require('graphql-middleware');

const nuqleus = {};

/**
 * @param {*} schema 
 * @param {*} clientExtensions 
 * @returns 
 */
nuqleus.ApolloWrapOptions = (typeDefs, resolvers, clientContext, clientFormatResponse, ...clientInputs) => {
  // create executableSchema
  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  // resolver level metrics invoked at each call
  const traceResolvers = async (resolve, root, args, context, info) => {
    const startTime = Date.now();
    const result = await resolve(root, args, context, info);
    const endTime = Date.now();
  
    const pathArray = [];
    let curPath = info.path;
    do {
      pathArray.push(curPath.key);
      curPath = curPath.prev;
    } while (curPath);
  
    const resolverData = {
      path: pathArray.reverse(),
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      fieldName: info.fieldName,
      duration: endTime - startTime,
      operation: info.operation.operation,
      parentType: info.parentType,
      returnType: info.returnType,
    };
  
    context.nuqleusQueryTimes.push(resolverData);
    return result;
  };

  // apply middleware to schema
  const schemaWithMiddleWare = applyMiddleware(schema, traceResolvers, ...clientInputs);

  /**
   * @returns must be a function that returns an object
   * 
   * fuse client context object with nuQLeus context
   */
  const fuseContexts = () => {
    if (typeof clientContext === 'object') {
      return (
        async ({ req, res }) => ({
          ...clientContext,
          nuqleusStartTime: Date.now(),
          nuqleusQueryTimes: [],
        })
      )
    }
    else if (typeof clientContext === 'function') {
      return (
        async ({ req, res }) => ({
          ...clientContext({ req, res }),
          nuqleusStartTime: Date.now(),
          nuqleusQueryTimes: [],
        })
      )
    }
  }

  /**
   * @returns must be a function that returns the response with an extensions object
   * 
   * fuse client formatResponse function with nuQLeus formatResponse
   */
  const fuseFormatResponse = (response, requestContext) => {
    return (
      (response, requestContext) => {
        const { context } = requestContext;
        response.extensions = {
          nuQLeusTracing: {
            startTime: new Date(context.nuqleusStartTime).toISOString(),
            endTime: new Date(Date.now()).toISOString(),
            duration: Date.now() - context.nuqleusStartTime,
            resolvers: context.nuqleusQueryTimes,
          }
        };
        clientFormatResponse(response, requestContext);
      }
    )
  }

  /**
   * @returns object with schema, context, and formatResponse
   * 
   * drop this object output into the client's new ApolloServer() instance
   */
  return {
    schema: schemaWithMiddleWare,
    context: fuseContexts(),
    formatResponse: fuseFormatResponse(response, requestContext),
  }
}

module.exports = nuqleus;