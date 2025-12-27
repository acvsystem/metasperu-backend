import bcrypt from 'bcrypt';

const passwordPlano = 'admin123';
const saltRounds = 10;

bcrypt.hash(passwordPlano, saltRounds, (err, hash) => {
    console.log("Tu nuevo Hash es:", hash);
});