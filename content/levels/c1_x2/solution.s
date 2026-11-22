# 性能挑战：高速计算 t3 = (t0 ^ t1) mod t2（二进制快速幂）
addi t3, zero, 1
rem  t0, t0, t2
loop:
beq  t1, zero, done
andi t4, t1, 1
beq  t4, zero, skip_mul
mul  t3, t3, t0
rem  t3, t3, t2
skip_mul:
mul  t0, t0, t0
rem  t0, t0, t2
srli t1, t1, 1
j    loop
done:
addi a7, zero, 0
ecall
