import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginSchema, RegisterSchema, LoginInput, RegisterInput } from '../schemas/event.schema';

// Mock user database (replace with real DB in production)
const users: Map<string, { id: string; email: string; password: string; name: string }> = new Map();

export default async function authRoutes(fastify: FastifyInstance) {
  
  // Register endpoint
  fastify.post('/register', {
    schema: {
      description: 'Register a new user',
      tags: ['auth'],
      body: RegisterSchema,
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
              },
            },
            token: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) => {
    try {
      const { email, password, name } = request.body;
      
      // Check if user exists
      if (users.has(email)) {
        return reply.code(409).send({
          success: false,
          error: { message: 'User already exists', code: 'USER_EXISTS' },
        });
      }
      
      // Create user (in production: hash password with bcrypt)
      const userId = `user_${Date.now()}`;
      users.set(email, {
        id: userId,
        email,
        password, // TODO: Hash password
        name,
      });
      
      // Generate JWT
      const token = fastify.jwt.sign({ 
        id: userId, 
        email,
        name,
      });
      
      request.log.info({ userId, email }, 'User registered successfully');
      
      return reply.code(201).send({
        success: true,
        user: { id: userId, email, name },
        token,
      });
    } catch (error: any) {
      request.log.error({ error }, 'Registration failed');
      return reply.code(500).send({
        success: false,
        error: { message: 'Registration failed', code: 'REGISTRATION_ERROR' },
      });
    }
  });

  // Login endpoint
  fastify.post('/login', {
    schema: {
      description: 'Login user',
      tags: ['auth'],
      body: LoginSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
              },
            },
            token: { type: 'string' },
          },
        },
      },
    },
  }, async (request: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) => {
    try {
      const { email, password } = request.body;
      
      // Find user
      const user = users.get(email);
      if (!user || user.password !== password) {
        return reply.code(401).send({
          success: false,
          error: { message: 'Invalid credentials', code: 'INVALID_CREDENTIALS' },
        });
      }
      
      // Generate JWT
      const token = fastify.jwt.sign({ 
        id: user.id, 
        email: user.email,
        name: user.name,
      });
      
      request.log.info({ userId: user.id, email }, 'User logged in successfully');
      
      return reply.code(200).send({
        success: true,
        user: { 
          id: user.id, 
          email: user.email, 
          name: user.name 
        },
        token,
      });
    } catch (error: any) {
      request.log.error({ error }, 'Login failed');
      return reply.code(500).send({
        success: false,
        error: { message: 'Login failed', code: 'LOGIN_ERROR' },
      });
    }
  });

  // Verify token endpoint
  fastify.get('/verify', {
    schema: {
      description: 'Verify JWT token',
      tags: ['auth'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    },
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ 
          success: false, 
          error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } 
        });
      }
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as any;
    
    return reply.code(200).send({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  });
}
