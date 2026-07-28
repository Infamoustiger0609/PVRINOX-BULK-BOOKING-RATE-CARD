import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { buildSessionCookie } from '../_lib/auth.js';

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7d, matches the JWT's own expiresIn

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { data: employee } = await supabaseAdmin
    .from('employees')
    .select('id, name, email, password_hash')
    .eq('email', String(email).toLowerCase().trim())
    .maybeSingle();

  // Same generic error whether the email doesn't exist or the password is wrong —
  // never reveal which one it was.
  if (!employee || !(await bcrypt.compare(password, employee.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: employee.id, name: employee.name, email: employee.email }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

  res.setHeader('Set-Cookie', buildSessionCookie(token, SESSION_MAX_AGE_SECONDS));
  return res.status(200).json({ name: employee.name, email: employee.email });
}
