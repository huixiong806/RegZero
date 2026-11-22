# 挑战（禁用 mul）：用移位与加减算出 t1 = t0*10，t2 = t0*15
slli t1, t0, 3
slli t3, t0, 1
add  t1, t1, t3
slli t2, t0, 4
sub  t2, t2, t0
ecall
