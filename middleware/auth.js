const jwt = require("jsonwebtoken");

/**
 * Auth Middleware: The Gatekeeper
 * 1. ดึง Token จาก Authorization Header (Bearer) หรือ Cookie
 * 2. ตรวจสอบความถูกต้องด้วย JWT_SECRET
 * 3. เก็บข้อมูล User ลงใน req.user
 */
const authenticateToken = (req, res, next) => {
  // ดึง Token จาก Header หรือ Cookie (กรณี SSR)
  const authHeader = req.headers["authorization"];
  const tokenFromHeader = authHeader && authHeader.split(" ")[1];
  const tokenFromCookie = req.cookies ? req.cookies.auth_token : null;
  
  const token = tokenFromHeader || tokenFromCookie;

  if (!token) {
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
      return res.status(401).json({ message: "Unauthorized: No token provided" });
    }
    return res.redirect("/");
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(403).json({ message: "Forbidden: Invalid token" });
      }
      return res.redirect("/");
    }
    
    // เอาข้อมูล User (id, username, roles) ไปใส่ไว้ใน req.user
    req.user = user;
    next();
  });
};

/**
 * Role Validation: ฟังก์ชันสำหรับเช็คสิทธิ์ (Role)
 * ใช้ในลักษณะ authorize(['admin', 'soltrapay_manager'])
 */
const authorize = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userRoles = req.user.roles || [];
    const hasRole = allowedRoles.some(role => userRoles.includes(role));

    if (!hasRole) {
      return res.status(403).json({ 
        message: "Forbidden: You do not have permission to access this resource" 
      });
    }

    next();
  };
};

module.exports = { authenticateToken, authorize };
