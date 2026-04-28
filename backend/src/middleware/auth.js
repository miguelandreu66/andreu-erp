const jwt = require('jsonwebtoken');

const auth = (rolesPermitidos = []) => (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (rolesPermitidos.length && !rolesPermitidos.includes(decoded.rol)) {
      return res.status(403).json({ error: 'Sin permisos' });
    }
    req.usuario = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

module.exports = auth;
