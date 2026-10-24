import { z } from 'zod';
export function friendlyError(error:unknown){return error instanceof z.ZodError?error.issues.slice(0,3).map(issue=>issue.message).join(' '):error instanceof Error?error.message:'The operation could not finish. Your saved work has been retained.';}
