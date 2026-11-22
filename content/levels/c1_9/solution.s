# 将从 t0 开始的连续 t1 个整数相加，总和存入 t2
addi t2, zero, 0
loop:
bge  zero, t1, done
lw   t3, 0(t0)
add  t2, t2, t3
addi t0, t0, 4
addi t1, t1, -1
j    loop
done:
ecall
