export default ({ env }) => ({
  connection: {
    client: 'postgres',
    connection: {
      host: env('DATABASE_HOST', 'database'),
      port: env.int('DATABASE_PORT', 5432),
      database: env('DATABASE_NAME', 'project_forge'),
      user: env('DATABASE_USERNAME', 'forge'),
      password: env('DATABASE_PASSWORD', 'forge'),
      ssl: env.bool('DATABASE_SSL', false),
    },
  },
});
