/** 高 16 位为所属组，低 16 位为可交互组。底盘仍与路面和护栏都碰撞。 */
export const COLLISION_GROUPS = {
  road: 0x0001ffff,
  barrier: 0x0002ffff,
  // 悬挂只查询路面，避免将护栏顶面或侧面当成轮胎支点。
  suspension: 0xffff0001,
} as const;
