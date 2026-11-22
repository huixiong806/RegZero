# 挑战：统计 t0 起 t1 个整数中满足 0 <= x < t2 的个数，存入 t3
addi t3, zero, 0
loop:
beq  t1, zero, done
lw   t4, 0(t0)
bgeu t4, t2, skip
addi t3, t3, 1
skip:
addi t0, t0, 4
addi t1, t1, -1
j    loop
done:
ecall
