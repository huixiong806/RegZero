# 编写递归子程序 fact(a0)，计算 t1 = t0!（0! = 1）
mv   a0, t0
jal  ra, fact
mv   t1, a0
j    done

fact:
addi t2, zero, 1
bge  t2, a0, fact_base
addi sp, sp, -8
sw   ra, 4(sp)
sw   a0, 0(sp)
addi a0, a0, -1
jal  ra, fact
lw   t2, 0(sp)
lw   ra, 4(sp)
addi sp, sp, 8
mul  a0, a0, t2
ret
fact_base:
addi a0, zero, 1
ret

done:
ecall
