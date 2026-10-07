import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

const ROUNDS = 12;

export const hashPassword = (password: string) => bcrypt.hash(password, ROUNDS);

// Gegen einen Dummy-Hash vergleichen, wenn es den User nicht gibt: gleiche Antwortzeit,
// man kann also nicht erkennen, ob ein Username existiert
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), ROUNDS);

export function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}

// Einmal-Passwort für neue Moderatoren und Resets: gut abtippbar, 16 Zeichen ohne Verwechsler
export function generateOneTimePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}
