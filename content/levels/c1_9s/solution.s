# 挑战：原地翻转从 t0 开始的连续 t1 个整数
addi t2, t1, -1
addi t3, zero, 4
mul  t2, t2, t3
add  t2, t0, t2
loop:
bge  t0, t2, done
lw   t3, 0(t0)
lw   t4, 0(t2)
sw   t4, 0(t0)
sw   t3, 0(t2)
addi t0, t0, 4
addi t2, t2, -4
j    loop
done:
ecall
