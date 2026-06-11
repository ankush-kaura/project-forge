import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client';
import { setContext } from '@apollo/client/link/context';
import { onError } from '@apollo/client/link/error';
import { API_URL } from '@/lib/api';

type GraphQLErrorLike = { extensions?: { code?: string } }
type ApolloErrorLike = {
  errors?: GraphQLErrorLike[]
  graphQLErrors?: GraphQLErrorLike[]
  networkError?: { statusCode?: number }
  statusCode?: number
}

const httpLink = createHttpLink({
  uri: `${API_URL}/graphql`,
});

const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem('token');
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : '',
    },
  };
});

// Auto-redirect to login on 401 (expired/invalid JWT)
const errorLink = onError(({ error }) => {
  const apolloError = error as ApolloErrorLike
  const graphQLErrors = apolloError.graphQLErrors ?? apolloError.errors ?? []
  const statusCode = apolloError.networkError?.statusCode ?? apolloError.statusCode
  const is401 =
    graphQLErrors?.some((e) => e.extensions?.code === 'UNAUTHENTICATED') ||
    statusCode === 401;
  if (is401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
});

export const client = new ApolloClient({
  link: errorLink.concat(authLink.concat(httpLink)),
  cache: new InMemoryCache(),
});
