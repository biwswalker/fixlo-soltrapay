/**
 * Permission Constants
 * ระบุว่าแต่ละ Role สามารถทำอะไรได้บ้าง
 */
const ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  STAFF: 'staff',
  VIEWER: 'viewer'
};

const PERMISSIONS = {
  WITHDRAW_VIEW: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF, ROLES.VIEWER],
  WITHDRAW_CREATE: [ROLES.OWNER, ROLES.ADMIN, ROLES.STAFF],
  WITHDRAW_DELETE: [ROLES.OWNER, ROLES.ADMIN],
  MANAGE_USERS: [ROLES.OWNER, ROLES.ADMIN]
};

/**
 * Helper: ตรวจสอบว่า Role ของ User มีสิทธิ์ที่ต้องการหรือไม่
 */
const hasPermission = (userRoles, requiredPermission) => {
  if (!userRoles || !Array.isArray(userRoles)) return false;
  
  const allowedRoles = PERMISSIONS[requiredPermission];
  if (!allowedRoles) return false;

  return userRoles.some(role => allowedRoles.includes(role));
};

module.exports = {
  ROLES,
  PERMISSIONS,
  hasPermission
};
