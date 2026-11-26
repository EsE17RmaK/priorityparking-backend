require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const adminUser = process.env.ADMIN_DEFAULT_USER || 'UTP-ADMIN';
  const adminPass = process.env.ADMIN_DEFAULT_PASS;

  if (!adminPass) {
    throw new Error('Falta definir ADMIN_DEFAULT_PASS en el archivo .env');
  }

  // Encripta la contraseña antes de guardarla en PostgreSQL
  const passwordEncriptada = await bcrypt.hash(adminPass, 10);

  const admin = await prisma.usuarioSistema.upsert({
    where: { username: adminUser },
    update: { passwordHash: passwordEncriptada },
    create: {
      username: adminUser,
      passwordHash: passwordEncriptada,
      nombreCompleto: 'Administrador General Sede Lima Centro',
      rol: 'ADMIN',
      activo: true,
    },
  });

  console.log(`✅ Usuario administrador sincronizado: ${admin.username}`);
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });