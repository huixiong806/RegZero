# 性能挑战：对 32 位细胞行 t0 按 Rule 110 演化 t1 代，结果存入 t2
mv   t2, t0
loop:
beq  t1, zero, done
srli t3, t2, 1
slli t4, t2, 1
xor  t5, t2, t4
xori t3, t3, -1
and  t3, t3, t2
or   t2, t5, t3
addi t1, t1, -1
j    loop
done:
addi a7, zero, 0
ecall
