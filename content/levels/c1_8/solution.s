# 将 0(t0) 与 4(t0) 处的两个整数相加，结果写回 8(t0)
lw  t1, 0(t0)
lw  t2, 4(t0)
add t3, t1, t2
sw  t3, 8(t0)
ecall
