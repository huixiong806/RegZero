# 挑战：统计 32 位整数 t0 的二进制中有多少个 1，存入 t1
addi t1, zero, 0
loop:
beq  t0, zero, done
addi t2, t0, -1
and  t0, t0, t2
addi t1, t1, 1
j    loop
done:
ecall
