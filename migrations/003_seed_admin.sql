insert into users (username, password_hash, role)
values (
  'admin',
  'scrypt:856ff8b1143d04006ce877ed7df7ce29:b3cb44fb2ca7be7a12bb644bc72efce0b14222edd04b737e7b51db48ce548408f165afc9d58dc84c8f1f5c6f83108b805ece30ee49ff70ae67560d00d143693e',
  'admin'
)
on conflict (username) do nothing;
