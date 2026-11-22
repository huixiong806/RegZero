# 挑战：找出 t0 起 t1 个整数中唯一未成对出现的数，存入 t2
addi t2, zero, 0
loop:
beq  t1, zero, done
lw   t3, 0(t0)
xor  t2, t2, t3
addi t0, t0, 4
addi t1, t1, -1
j    loop
done:
ecall
